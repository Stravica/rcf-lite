# application-admin-console: operator guide

## When to reach for it

Your project applies at least one shelf `security-auth-*` blueprint (or a custom identity source declaring `principalDirectory` via the elicitation phase). You need an admin console that identifies principals, manages roles, and reads a change history. You want the console to configure itself from the applied capability set rather than demand configuration.

## When NOT to reach for it

You are shipping a fully-featured, opinionated admin product (Retool, an internal admin CMS, a bespoke ops console). Adopt this blueprint only when a vendor-neutral shell composed from the applied identity blueprint suits your project better than a fixed opinionated console.

You want an anonymous product (no principal directory, no roles). The blueprint refuses at apply on a bare SPA; `--allow-no-auth-yet` accepts the refusal for a scaffolding pass but the surfaces will not activate until an identity capability is applied.

## What stays your call

- Which shelf auth blueprint you apply first (or whether you supply custom auth via the elicitation phase).
- The elicited additional role labels beyond Owner + Admin + Member + Viewer.
- The invite transport (email, in-app-only, or custom).
- The tenancy shape (per-user, per-org, or both) if you apply a tenancy blueprint.
- The audit-log retention window (default 90 days).

## Mechanism-reach gaps

The blueprint's README lists the runtime-observable ACs the pack does NOT bind directly. Every gap is a candidate for a v1.1.0 minor bump extending the pack; the shipped v1.0.0 pack anchors the four load-bearing surface checks. Combine with the datatable pack to reach the users and audit shells' state-region contract.

## Promotion signals

- The role catalogue label vocabulary drifts across three or more applied auth blueprints: candidate for a `roleModel` global topic in a v1.1.0 minor.
- The tenancy shape needs a real shelf provider: candidate for the `application-tenancy-orgs` blueprint (spec section 11).
- A dedicated audit-log blueprint ships: candidate for the console to consume it directly via `capabilities: ["auditLog"]` rather than through the logging companion.

## v1.1.0 minor: Access-gate consumption (Cloudflare round 6)

Applying `edge-cloudflare-access` v1.0.0 alongside `application-admin-console` v1.1.0 flips the sign-in surface on `/admin/sign-in`. The admin-console reads `appliedCapabilities` at apply-time via the shipped `readAppliedCapabilities()` helper (the visual-round mechanism).

- With `zeroTrustGate` in the applied set: the sign-in page renders `[data-surface=access-gated]` with no local login form. A `[data-role=principal-read]` element carries the principal email the `edge-cloudflare-access` JWT validator attached to `request.auth`. The shipped pack check `AC-21815-1` on `application-admin-console.pack.mjs` asserts the shape.
- Without `zeroTrustGate`: the sign-in page renders `[data-surface=local-login]` with the local `security-auth-*` form unchanged from v1.0.0. Every v1.0.0 deployment continues to work; the minor is strictly additive.

The Q4 default (spec section 5.4.1) is: consumption is OPTIONAL. `requiresAppliedCapabilities.capabilities[]` remains `["principalDirectory"]`; making Access-gate hard is a v2.0 change (the fallback branch would be removed).

Composed apply-line, one project:

```
rcf define blueprint add application-admin-console --version 1.1.0
rcf define blueprint add edge-cloudflare-access --version 1.0.0 --answer access-application-host=admin.example.com --answer access-audience=<audience> --answer access-jwks-url=https://<team>.cloudflareaccess.com/cdn-cgi/access/certs --answer access-policy-shape=email-domain
```

Fall-back apply-line (no Access; the v1.1.0 admin-console behaves identically to v1.0.0):

```
rcf define blueprint add application-admin-console --version 1.1.0
```

Standards trace clause for the ADR: `Cloudflare round 6 spec section 5.4 (admin-console v1.1.0 delta)`.
