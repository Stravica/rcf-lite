# security-auth-magic-link CHANGELOG

## 1.2.7 - 2026-09-11

- Criterion-e probe pack fix pass: every conformance-only result row now records `anchorAcId: null` alongside a `limitation` that opens with a shipped AC id from the blueprint's user stories (token-entropy rows and the fixture manager rows move from `REQ-002` to `AC-3102-1` / `AC-3102-2` / `AC-3102-3`; the live `real-account-magic-link-send` row remains under `AC-3110-1` as its limitation citation). Detail strings on de-claimed rows describe only what was observed at the surface the probe drove (Resend adapter return for the live probe; fixture manager return for the local probes) and no longer describe `AC-3110-1` as exercised end to end. Probe source header on `real-account-magic-link-send` matches the de-claim comment (no "exercises AC-3110-1 end-to-end" wording). `token-issue-verify` header comment matches its implementation (every row de-claims, including AC-3102-3). Anatomy helper tightened: conformance-only rows must satisfy `anchorAcId === null`, limitations must open with an `AC-<n>-<n>` id (REQ-prefixed anchors are refused), and pre-delete presence is no longer counted as an absence observation on the inventory-diff shape. Probe comments and CHANGELOG prose reworded to drop lane/review labels.

## 1.2.6 - 2026-09-11

- Every conformance-only anchor on the criterion-e probe pack is de-claimed to `conformanceOnly` with a limitation naming the shipped AC that is observable only in the integration harness follow-up. The Resend adapter now returns `error: null` on success so the four declared keys (ok, providerStatus, providerMessageId, error) are always present, and the probe now requires all four (the previous check allowed missing `error`). Live evidence on `real-account-magic-link-send` (Resend HTTP send through the adapter) is preserved; anchor drops to null and the limitation says why.

## 1.2.5 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering the principalDirectory capability across three probes: `token-issue-verify` (single-use, TTL-bounded, email-bound token with constant-time compare; local, deterministic clock), `token-entropy-shape` (1,000-token uniqueness + base64url shape sweep), and `real-account-magic-link-send` (LIVE; drives Resend's HTTP API sending to sandbox recipient `delivered@resend.dev` from sandbox sender `onboarding@resend.dev` and records the Resend-assigned email id, HTTP status and `cf-ray` request id on the adapter return; verifies the issued token locally for end-to-end shape). Fixture at `packages/rcf-lite/test/fixtures/security-auth-magic-link/` declares every env var; anatomy test pins pack shape, fixture manifest and the account-bound skip contract.
- Iteration on the probe pack routed the outgoing send through a fixture `email-delivery-adapter` whose default binding is Resend, so live evidence carries the provider-assigned message id and the HTTP request id on the adapter's returned shape rather than a direct-vendor call. `aggregate([])` and null-result normalisation now report `detail: 'no checks ran'` exactly. Slug reads AMBER on criterion e.

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
