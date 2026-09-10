# edge-cloudflare-access guide

## When to reach for this blueprint

You reach for `edge-cloudflare-access` when your Workers project
needs an authenticated edge (only authenticated principals reach
the origin Worker), when you have adopted the Zero Trust posture,
and when you want a vendor-neutral seam (`request.auth`) between
Cloudflare's Access edge and your downstream handlers.

If you are shipping a fully-public Worker (no authentication at all),
this blueprint is not for you. If you are running a security-auth-*
blueprint inside the Worker (in-app authentication), you probably
also want Cloudflare Access as a second layer to keep unauthenticated
traffic off the origin; the composition is straightforward.

## Composition with application-admin-console

Applying `application-admin-console` v1.1.0 alongside this blueprint
flips the admin-console sign-in surface (`/admin/sign-in`):

- With `zeroTrustGate` in the applied capability set (this
  blueprint declares it): the sign-in page renders
 `[data-surface=access-gated]` with no local form.
- Without `zeroTrustGate` (this blueprint not applied): the
  sign-in page renders `[data-surface=local-login]` with the local
 `security-auth-*` form unchanged from v1.0.0.

The Q4 default (spec section 5.4.1) is: consumption is OPTIONAL.
The v1.1.0 admin-console remains backward-compatible with every
v1.0.0 deployment.

## Elicited parameters at apply

- `access-application-host` OR `access-selfhosted-app-id`: pick
  exactly one. The dashboard walk-through follows the hostname
  path when the first is set and the self-hosted-app id path
  when the second is set.
- `access-audience`: the JWT audience tag the Access policy issues.
  Every JWT the validator accepts must carry this string as its
 `aud` claim.
- `access-jwks-url`: the JWKS endpoint URL the validator fetches.
  Cloudflare Access publishes this at
 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.
- `access-policy-shape` (default `email-domain`): one of the four
  values in the enum below.
- `access-bypass-service-auth-id`: leave blank to disable
  break-glass. When set, the paired secret is delegated to the
  applied `secretsManagement` companion.

## Policy shape enum

| Shape | What it allows | Suited to |
| --- | --- | --- |
| `email-domain` | Any principal whose email ends `@<domain>` on the Access-managed identity provider. | Solo, small team, workspace-wide access on a company domain. |
| `service-token-only` | Only the elicited bypass-service-auth pair; no browser principals. | CI-only endpoints (webhooks, ingest APIs). |
| `service-token-plus-email-domain` | Either the paired service-auth or an on-domain email principal. | Endpoints reached by CI AND humans. |
| `group-membership` | Only principals whose identity-provider group claim contains an elicited group name (Okta, Entra ID, Google Groups). | Enterprise SSO with role-based access. |

The Cloudflare edge enforces the shape before a request reaches
the origin Worker; the shipped validator receives the JWT the
Access edge signs and verifies the audience, the expiry and the
signature.

## Zero Trust dashboard walk-through

Screen-by-screen path for a fresh Cloudflare account. Vendor URL:
`https://developers.cloudflare.com/cloudflare-one/policies/access/`.

1. Sign in to `dash.cloudflare.com` and select your account.
2. In the left nav, open `Zero Trust`. If the dashboard prompts
   you to create a team, do so with the elicited team name (the
 `<team>` in `https://<team>.cloudflareaccess.com/`).
3. In the Zero Trust dashboard, open `Access` -> `Applications`,
   then `Add an application`.
4. Pick `Self-hosted` (both for hostname-scoped applications and
   for self-hosted-app id-based applications).
5. Enter the application name (`admin.example.com` for the
   hostname path or the app id string for the self-hosted-app id
   path), the session duration (default 24h is fine for an
   internal console) and the application domain (the hostname
   the Worker binds to).
6. On the `Add policies` screen, `Add a policy`.
7. On the policy screen, pick the `Action` (`Allow` for the
   principal set the shape names above), then add one `Include`
   selector matching the shape:
   - `email-domain`: `Include -> Email ending in` -> your domain.
   - `service-token-only`: `Include -> Service Auth Token` -> the
     token generated in `Zero Trust` -> `Access` -> `Service Auth`.
   - `service-token-plus-email-domain`: add both selectors.
   - `group-membership`: `Include -> IdP Group name` -> the group
     the elicited identity-provider claims.
8. Save the policy, save the application. The dashboard prints
   the `Application audience tag` at the top of the application
   card; copy it verbatim into the `access-audience` elicit
   answer on apply.
9. Confirm the JWKS endpoint at
 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
   returns a valid JWKS document; copy the URL into the
 `access-jwks-url` elicit answer.

The blueprint is now ready to apply on the Worker project.

## API alternative

If you prefer to script the policy issuance rather than click
through the dashboard, use the Cloudflare API. Vendor URL:
`https://developers.cloudflare.com/cloudflare-one/policies/access/`.

```
curl -X POST \
  https://api.cloudflare.com/client/v4/accounts/{account_id}/access/apps/{app_id}/policies \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Access policy for admin.example.com",
    "decision": "allow",
    "include": [
      { "email_domain": { "domain": "example.com" } }
    ],
    "session_duration": "24h"
  }'
```

Replace the `include` block with the shape you picked from the
enum. The `app_id` is the value the dashboard printed when the
application was created; the `account_id` is the standard
Cloudflare account id from your account settings. The endpoint is
idempotent when the policy name matches an existing policy per
Cloudflare's documented semantics.

## Break-glass posture

Set `access-bypass-service-auth-id` at apply to enable break-glass.
The paired secret is delegated to the applied `secretsManagement`
companion via `security-secrets-management`; the CI runner then
supplies both values as `CF-Access-Client-Id` and
`CF-Access-Client-Secret` headers on every request that would
otherwise fail Access at the browser boundary. The validator
observes the pair, records `outcome: bypass` on the audit sink
with the metadata-only shape, and delegates to the handler with
`request.auth.email = 'service:'+id`.

The break-glass code path is disabled unless an elicited pair is
applied; a request presenting the paired headers when no pair is
elicited is rejected as `missing` (fall through to the JWT path).

## Composed apply-line

One project, admin-console v1.1.0 plus edge-cloudflare-access
v1.0.0, `email-domain` policy shape:

```
rcf define blueprint add application-admin-console --version 1.1.0
rcf define blueprint add edge-cloudflare-access --version 1.0.0 \
  --answer access-application-host=admin.example.com \
  --answer access-audience=<audience-copied-from-dashboard> \
  --answer access-jwks-url=https://<team>.cloudflareaccess.com/cdn-cgi/access/certs \
  --answer access-policy-shape=email-domain
```

The admin-console applies first (its `principalDirectory`
requirement is met by whatever `security-auth-*` you have
applied). The Access blueprint applies second, records
`zeroTrustGate` on `rcf/blueprints/edge-cloudflare-access.applied.json`,
and the admin-console's next surface render picks the Access-gated
branch on `/admin/sign-in`.

## Standards trace

- `ADR-3501-edge-cloudflare-access-jwt-gate` carries
 `standardsTraceClause: Cloudflare Access policy actions and rule
  selectors` per
  https://developers.cloudflare.com/cloudflare-one/policies/access/.
- `ADR-3503-edge-cloudflare-access-policy-scope` carries the same
  clause.
- `ADR-3502-edge-cloudflare-access-identity-provider` and
 `ADR-3504-edge-cloudflare-access-audit-retention` carry the
  sentinel `generic enterprise practice` (no vendor documentation
  constrains identity provider or audit retention).
