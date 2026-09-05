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

The blueprint's README lists the runtime-observable ACs the pack does NOT bind directly. Every gap is a candidate for a v1.1.0 minor bump extending the pack; the shipped v1.0.0 pack anchors the four load-bearing surface checks. Combine with the T-1 datatable pack to reach the users and audit shells' state-region contract.

## Promotion signals

- The role catalogue label vocabulary drifts across three or more applied auth blueprints: candidate for a `roleModel` global topic in a v1.1.0 minor.
- The tenancy shape needs a real shelf provider: candidate for the `application-tenancy-orgs` blueprint (spec section 11).
- A dedicated audit-log blueprint ships: candidate for the console to consume it directly via `capabilities: ["auditLog"]` rather than through the logging companion.
