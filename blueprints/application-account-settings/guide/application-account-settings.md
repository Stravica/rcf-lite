# application-account-settings: operator guide

## When to reach for it

Your project applies at least one shelf `security-auth-*` blueprint (or a custom identity source declaring `principalDirectory` via the elicitation phase). You need an account-settings surface that lets each authenticated principal edit their profile, manage credentials, review sessions, adjust notification preferences and pick a theme. You want the surface to configure itself from the applied capability set rather than demand configuration.

## When NOT to reach for it

You are shipping a fully-featured, opinionated account product (a bespoke SaaS account console with 15 tabs, tightly-coupled billing, invoice history and organisation settings). Adopt this blueprint only when a vendor-neutral shell composed from the applied identity blueprints suits your project better than a fixed opinionated console.

You want an anonymous product (no principal, no profile). The blueprint refuses at apply on a bare SPA; `--allow-no-auth-yet` accepts the refusal for a scaffolding pass but the surfaces will not activate until an identity capability is applied.

## What stays your call

- Which shelf auth blueprint you apply first (or whether you supply custom auth via the four `custom-auth-provides-*` elicits).
- The `security-surface-shape` (self-service, hosted-link-out or hosted-embed). No recommended default: the shape leaks the vendor's identity architecture.
- The `hosted-identity-url` when the security surface is a hosted-link-out or hosted-embed.
- The `theme-persistence` strategy (spa-local-storage default, server-scoped, none).
- The `reauth-window` (never, 5, 15 or 60 minutes) applied to high-value changes.

## Mechanism-reach gaps

The blueprint's README lists the runtime-observable ACs the pack does NOT bind directly. Every gap is a candidate for a v1.1.0 minor bump extending the pack; the shipped v1.0.0 pack anchors the five load-bearing surface checks. Combine with the round-3 T-1 datatable pack to reach the sessions and notification-preferences shells' state-region contract.

## Promotion signals

- The security-surface-shape choice drifts across two or more projects on the same auth vendor: candidate for a per-vendor default on the auth blueprint's own elicit set (a Clerk 1.4.0 with a `hosted-link-out` recommended default, say).
- A dedicated `application-tenancy-orgs` blueprint ships: candidate for the account-settings shell to add an organisation-membership surface in a v1.1.0 minor bump.
- A dedicated audit-history surface is needed at the account scope: candidate for a v1.1.0 minor bump reusing the `auditLog` capability with no new vocabulary.
- The Q3 refusal fires often in support tickets: candidate for a shell-side "auth managed elsewhere" placeholder as an opt-in via a new elicit `security-surface-suppression=explicit-none`.
