# Changelog

## 1.1.0 - 2026-09-09

Hardening pass B3 edge (criterion a REQ-layer backing; criterion b AC-set sufficiency; criterion c chain consistency lint-zero on pass 1 and pass 2).

- Normalised the `cf-turnstile-response` token casing across the shipped guide, README, REQs, TACs and user stories to the lowercase form-field literal Cloudflare's client-side rendering and server-side validation docs specify verbatim (closes specimen F-1 in the vendor-fact direction under 7b; earlier interim pass mistakenly took the pre-existing TAC-3601 title-case as canonical). TAC-3601 owns the literal with a `vendorCitation` and US-35101 AC-35101-1 is re-marked `fixed` with the same citation. The consistency-lint AC-3 spec test continues to assert the specimen is closed on the shipped blueprint.
- Added failure-path ACs to US-35102 (AC-35102-2..4 close F-3: missing sitekey, missing secret, only-one-of-pair boot refusal) and US-35103 (AC-35103-2..6 close F-2: siteverify timeout, network failure, non-2xx upstream, invalid JSON, missing success-field fail-closed).
- Every REQ now carries `deliveredBy`; every AC carries `disposition` (`AC-35102-1` and `AC-35103-1` marked `fixed` with vendor citations to the Cloudflare Turnstile testing docs); ACs referencing owner-owned literals carry `ownerRef`.
- Chain-consistency lint reports 0 findings on both passes.


All notable changes to `edge-cloudflare-turnstile` are recorded here. The shape follows Keep a Changelog and Semantic Versioning per the blueprint authoring standard.
- Review fix pass (2026-09-09): flipped `cf-turnstile-response` to the lowercase vendor literal per Cloudflare's client-side rendering and server-side validation docs across guide, README, CHANGELOG, REQ-001, REQ-003, TAC-3601, TAC-3602, US-35101, US-35104 and US-35105 (closes F-1 blocker in the vendor-fact direction); TAC-3601 responsibility 3 owns the literal and US-35101 AC-35101-1 re-marked `fixed` with `vendorCitation` at the client-side-rendering page. Added `AC-35101-2` for the always-fail test-sitekey mount branch (`fixed`, `vendorCitation` at the Cloudflare testing docs). Split US-35104 into canonical-shape (guard-shape-scan) and missing-token-runtime (400 turnstile.token-missing) ACs each with a concrete oracle and an `ownerRef` into TAC-3602. Vendor citations added on US-35101 AC-35101-1/2, US-35102 AC-35102-1, US-35103 AC-35103-1, US-35104 AC-35104-2, US-35105 AC-35105-2 and US-35106 AC-35106-1. Every AC in this blueprint is `fixed` (refusal codes, event-secrecy record shapes, probe verdicts and vendor test-key observables are all mechanism-invariant). Genuinely single-mechanism stories (US-35106, US-35107, US-35108) carry the section-7a note inside the story `description` field, not in a schema-illegal new field.


## 1.0.0 (2026-09-07)

### Added

- v1.0.0 mint of the `edge-cloudflare-turnstile` blueprint, category `edge`, capabilities `["humanCheck"]`. Ships a client widget mount, a server-side siteverify verifier that POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the elicited secret, a refuse-if-token-missing guard on every elicited surface, and a composition hook into `security-auth-magic-link` mint surface.
- 5 REQs (`edge-cloudflare-turnstile-REQ-001..005`), 8 USs (`edge-cloudflare-turnstile-US-35101..35108`), 3 TACs (`TAC-3601` widget mount, `TAC-3602` server verifier plus token-required guard, `TAC-3603` magic-link hook), 3 ADRs (`ADR-3601` scope-global on new topic `humanVerificationGate` with `standardsTraceClause: Cloudflare Turnstile siteverify endpoint documented shape`; `ADR-3602` widget mode enum elicit with `recommendedDefault: managed`; `ADR-3603` refuse shape 400 with error-code body and no sitekey leak).
- 4 Node-only probes under `contributions/probes/`: `secret-shape-scan` (source-tree AST scan asserts `TURNSTILE_SECRET` is only read through the env facade and refuses non-test secret literals), `siteverify-fixture` (drives the LIVE `challenges.cloudflare.com/turnstile/v0/siteverify` endpoint with the pinned always-pass and always-fail Cloudflare test secrets and asserts `success:true` and `success:false` respectively), `guard-shape-scan` (source scan plus live missing-token POST against every guarded surface), `event-secrecy` (asserts every event record carries `{sitekeyHash, outcome, timestamp}` keys only; no token, no secret leak).
- 1 Playwright probe pack (`probe-packs/edge-cloudflare-turnstile.pack.mjs`) with 4 surface-observable checks per spec section 3.2: `AC-turnstile-widgetRendered` (widget mounts, iframe/script from the Cloudflare Turnstile origin only, `cf-turnstile-response` token populated, no third-party script), `AC-turnstile-serverVerified-pass` (`/api/submit` 200 on always-pass secret), `AC-turnstile-serverVerified-fail` (`/api/submit` 400 on always-fail secret with `errorCodes` and no sitekey leak), `AC-turnstile-magicLinkGuard` (mint refuses missing-token and always-fail-secret with 400 and no mint side-effect).
- 4 elicited parameters on `blueprint.json`: `turnstile-sitekey`, `turnstile-secret` (routed through `security-secrets-management` when applied), `turnstile-widget-mode` (enum default `managed`), `turnstile-guarded-surfaces`.
- `suggestedCompanions`: `logging` (for the metadata-only event sink retention), `errorHandling` (for the verifier failure boundary), `secretsManagement` (for the paired sitekey and secret).
- Ships the dedicated pack fixture at `packages/rcf-lite/test/fixtures/probe-pack-edge-cloudflare-turnstile/` per spec section 3.3. The fixture pins the Cloudflare public test keys documented at `https://developers.cloudflare.com/turnstile/troubleshooting/testing/` as environment defaults so the pack runs without real Turnstile credentials.
- Anatomy test at `packages/rcf-lite/test/blueprint/edge-cloudflare-turnstile-anatomy.test.js` covers TS-120..127 on the T-5 repo-chain slice.

### Known limitations

- No account-bound probe. Cloudflare Turnstile documents its endpoint and test keys as public; the live siteverify calls in the shipped probes route through Cloudflare with no operator account required. A real-account variant would gate on a specific applying-project sitekey and secret pair; the shipped test-key runs cover the wire-shape contract.
