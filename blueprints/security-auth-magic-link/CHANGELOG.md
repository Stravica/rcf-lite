# security-auth-magic-link CHANGELOG

## 1.2.5 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering the principalDirectory capability across three probes: `token-issue-verify` (single-use, TTL-bounded, email-bound token with constant-time compare; local, deterministic clock), `token-entropy-shape` (200-token uniqueness + base64url shape sweep), and `real-account-magic-link-send` (LIVE; drives Resend's HTTP API sending to sandbox recipient `delivered@resend.dev` from sandbox sender `onboarding@resend.dev` and records the Resend-assigned email id, HTTP status and `cf-ray` request id as positive evidence; verifies the issued token locally for end-to-end shape). Fixture at `packages/rcf-lite/test/fixtures/security-auth-magic-link/` declares every env var; anatomy test pins pack shape, fixture manifest and the account-bound skip contract.

## 1.2.4

- Closure fix pass (F-2, F-3): rewrites the `README.md` shelf-latest line in neutral customer-facing voice with no spec-provenance label; drops the vendor-implementation naming from the guide narrative and describes the reference container-plus-realm shape generically.

## 1.2.3

- Rewrites `REQ-010.description` to reference `TAC-504-security-auth-magic-link-email-delivery-adapter` `responsibilities.send` rather than restate the `{ ok, providerStatus, providerMessageId, error }` return shape verbatim; the literal remains owned by the delivering TAC.

## 1.2.2 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.2.1 (hardening pass, spec 2026-09-09 section 5.4.2)

- Adds `deliveredBy` on every `must` requirement and `disposition: fixed` on every existing acceptance criterion; adds `ownerRef` on ACs that restate the `isRegistered` interface on `TAC-505`. Extends `REQ-003` with the session-lifetime contract (sliding idle window, absolute lifetime, server-side revocation as the only truthful invalidation). Names the `principalDirectory` capability on `REQ-011`, which already carries its runtime clause through the principal-registry contract. hardening pass (criteria a, b, c on the 2026-09-09 programme). No new contributions.

## 1.2.0 (visual round, spec 2026-09-06 section 5.4.2, doc-only)

- No change to `capabilities[]`; the declaration remains `[principalDirectory]`. The bump records the account-settings suppression behaviour: on a bare-magic-link project the security tab, the sessions tab, the notification-preferences tab (unless `application-notifications-in-app` is applied) and the theme tab (unless `application-spa` is applied) are all suppressed by the account-settings blueprint capability discovery, and only the profile surface renders. This is not a regression; magic-link intentionally does NOT self-declare a credential-self-service surface, a session inventory, or a hosted identity UI (the click-a-link flow is the whole surface). Consumers pair magic-link with a session store (or a logging companion) if they want a sessions surface.

## 1.1.0 (visual round, spec 2026-09-04 section 5.5.2, operator Q2 default)

- Declares `capabilities: [principalDirectory]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump), and it is consumed by the visual round `application-admin-console` blueprint at apply time to gate surfaces on what the applied identity blueprint actually provides.
