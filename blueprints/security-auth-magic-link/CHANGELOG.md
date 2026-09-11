# security-auth-magic-link CHANGELOG

## 1.2.6 - 2026-09-11

- Third closure remediation (2026-09-11): every AC/REQ anchor on the criterion-e probe pack is de-claimed to conformanceOnly with a limitation naming the AC that is observable only in the auth integration harness follow-up. The Resend adapter now returns `error: null` on success so the four declared keys (ok, providerStatus, providerMessageId, error) are always present, and the probe now requires all four (the previous check allowed missing `error`). Live evidence on `real-account-magic-link-send` (Resend HTTP send through the adapter) is preserved; anchor drops to null and limitation says why. Anatomy helper rewritten to enforce field combinations per shape. This pack is criterion-e conformance evidence pending the integration harness.

## 1.2.5 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering the principalDirectory capability across three probes: `token-issue-verify` (single-use, TTL-bounded, email-bound token with constant-time compare; local, deterministic clock), `token-entropy-shape` (1,000-token uniqueness + base64url shape sweep), and `real-account-magic-link-send` (LIVE; drives Resend's HTTP API sending to sandbox recipient `delivered@resend.dev` from sandbox sender `onboarding@resend.dev` and records the Resend-assigned email id, HTTP status and `cf-ray` request id as positive evidence; verifies the issued token locally for end-to-end shape). Fixture at `packages/rcf-lite/test/fixtures/security-auth-magic-link/` declares every env var; anatomy test pins pack shape, fixture manifest and the account-bound skip contract.
- Closure fix pass (second closure DO-NOT-MERGE addressed): the token-entropy probe no longer claims AC-3103-1 / AC-3103-2 (those ACs bind session-handle entropy, and the fixture is a magic-link token manager, not a session manager). The 1,000-sample uniqueness + base64url shape row now anchors REQ-002 with the mis-fit stated in `detail` (no AC covers magic-link-token entropy at the manager layer). The real-account probe now routes the outgoing send through a fixture `email-delivery-adapter` whose `send({ to, subject, textBody, htmlBody }) -> { ok, providerStatus, providerMessageId, error }` shape is the surface AC-3110-1 names; the adapter's default binding is Resend, so live evidence carries the provider-assigned message id and the HTTP request id on the adapter's returned shape rather than a direct-vendor call. The adapter's return shape is inspected by the probe and asserted per AC-3110-1. `real-account-magic-link-send` is labelled `engine: resend` on the live branch. The token-issue-verify probe remains labelled `engine: fixture` (application-code, own-engine per closure addendum rule 2) and observes AC-3102-1 / AC-3102-2 / AC-3102-3 at the manager layer; the GET /login/verify status/cookie behaviour is not observed at this layer and the `detail` says so. `aggregate([])` and null-result normalisation report `detail: 'no checks ran'` exactly. Anatomy `assertEvidenceOrSkip` tightened to require one of the four 7d shapes or an honest skip. Slug reads AMBER on criterion e for the token-entropy and GET-/login/verify rows; live-send row is GREEN.

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
