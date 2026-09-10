# Changelog

## 1.1.3 - 2026-09-10

Register tidy in shipped prose; no capability change.

- Closes F-8: README compose bullet and consumer note stripped of internal pattern label.
- Closes F-9: REQ-006 description stripped of internal mechanism label.

## 1.1.2 - 2026-09-10

Single-mechanism story legality notes; owner reference for the audit-record shape.

- Appended the section 7a legality note to AC-34101-1, AC-34105-1, AC-34106-1, AC-34108-1, AC-34109-1 and AC-34110-1 recording that each single-AC story's mechanism has no additional documented failure path in the guide or the anchored TAC (adjacent failure paths are owned by sibling stories, not by these).
- Rewrote REQ-004 description to reference the owning TAC field (`TAC-3501-edge-cloudflare-access-jwt-validator.responsibilities[2]`) for the audit-record shape, rather than restating the shape verbatim.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 - 2026-09-09

hardening pass edge (criterion a REQ-layer backing; criterion b AC-set sufficiency; criterion c chain consistency lint-zero on pass 1 and pass 2).

- Added REQ-007 and US-34110: the shipped guide names, per policy-shape option, the required dashboard-owned inputs (email domain, group name, identity provider, application-vs-path scope) and every shipped elicit alongside its runtime effect (closes F-1).
- Added failure-path ACs to US-34102 (AC-34102-2..5 close F-2: wrong audience, malformed JWT, unknown kid after refresh, JWKS-unavailable fail-closed); US-34104 (AC-34104-2..3 close F-3: neither and both application identifiers refuse apply); US-34107 (AC-34107-2..5 close F-4: break-glass disabled, wrong id, wrong secret via constant-time compare, and partial-pair fall-through).
- Every REQ now carries `deliveredBy`; every AC carries `disposition`; ACs referencing owner-owned literals carry `ownerRef`.
- De-identified in-house references in US-34109.
- Chain-consistency lint reports 0 findings on both passes.


All notable changes to `edge-cloudflare-access` are recorded here. The shape follows Keep a Changelog and Semantic Versioning per the blueprint authoring standard.
- Review fix pass (2026-09-09): split US-34103 into canonical-pass and SIMULATE_NON_VALIDATOR_HEADER-fail ACs, each with a concrete oracle (probe verdict + named field) and an `ownerRef` into TAC-3501. Re-marked ACs per section 7b: mechanism-invariant refusal reasons (`aud-mismatch`, `jwt-malformed`, `kid-unknown`, `jwks-unavailable`, `bypass-id-mismatch`, `bypass-secret-mismatch`, `jwt-missing`), audit-record shapes, guide-section presence assertions and the JWT validator happy path stay `fixed`; US-34104 AC-34104-1 (elicit shape recording), US-34107 AC-34107-1/-3/-4/-5 (bypass id/secret pair) and US-34109 AC-34109-1 (CF_ACCESS_HOST) re-marked `template` naming the values the applying agent sets (access-application-host or access-selfhosted-app-id, access-audience, access-jwks-url, access-policy-shape enum, access-bypass-service-auth-id + paired secret, CF_ACCESS_HOST). Vendor citations added on US-34101 (Cf-Access-Jwt-Assertion header), US-34105 (Zero Trust dashboard docs), US-34107 AC-34107-1 (service-tokens docs) and US-34109 (Access policies docs). Genuinely single-mechanism stories (US-34101, US-34105, US-34106, US-34108, US-34109, US-34110) carry the section-7a note inside the story `description` field, not in a schema-illegal new field.


## 1.0.0 (2026-09-07)

### Added

- v1.0.0 mint of the `edge-cloudflare-access` blueprint, category `edge`, capabilities `["zeroTrustGate"]`. Ships a shipped JWT validator middleware that is the sole reader of the `Cf-Access-Jwt-Assertion` header per REQ-001, an Access application declaration surface with elicited hostname or self-hosted-app id, an elicited policy shape from the enum (email-domain, service-token-only, service-token-plus-email-domain, group-membership), a metadata-only audit event contract per REQ-004, and a break-glass posture per REQ-005 with an elicited service-auth pair for CI-signed automation.
- 6 REQs (`edge-cloudflare-access-REQ-001..006`), 9 USs (`edge-cloudflare-access-US-34101..34109`), 4 TACs (`TAC-3501` JWT validator, `TAC-3502` Access application declaration, `TAC-3503` policy shape enum, `TAC-3504` audit sink), 4 ADRs (`ADR-3501` scope-global on new topic `edgeAuthenticationGate` with `standardsTraceClause: Cloudflare Access policy actions and rule selectors`; `ADR-3502` identity provider elicited with `recommendedDefault: null`; `ADR-3503` policy scope elicited with `recommendedDefault: application-level`; `ADR-3504` audit retention delegated to the applied logging companion with sentinel clause).
- 6 Node-only probes under `contributions/probes/`: `jwt-validator-fixture` (fixture-signed JWT validates and principal reduces to `{email, sub, groups}` on request.auth), `jwt-validator-reject` (three subcases: missing header, expired exp, mis-signed each return 401 with one metadata-only audit event), `admin-console-gate-surface` (extended admin-console fixture flips its sign-in surface per applied capability set; covers `AC-34108-1`), `audit-event-secrecy` (5 pass + 5 reject runs produce 10 metadata-only records with no forbidden substrings, no token slices, no header names beyond `path`), `real-account-gated-url` (`accountBound: true`; records `accountBoundSkipped: true` in CI without `CI_HAS_CLOUDFLARE_ACCOUNT` per spec section 3.5) and `wrangler-seam` (drives `wrangler dev --local` on the fixture; `/protected` returns HTTP 401 on the shipped validator's missing-header reject path; `/health` returns HTTP 200 exempt; warn semantics per section 3.1 pass-with-skip if wrangler is missing or fails to bind).
- 6 elicited parameters on `blueprint.json`: `access-application-host` (or `access-selfhosted-app-id`, exactly one required), `access-audience`, `access-jwks-url`, `access-policy-shape` (enum default `email-domain`), `access-bypass-service-auth-id` (blank disables break-glass).
- `suggestedCompanions`: `logging` (for the metadata-only audit sink retention), `errorHandling` (for the validator failure boundary) and `secretsManagement` (for the paired break-glass service-auth secret).
- Ships the shared `cf-edge` sample-app fixture at `packages/rcf-lite/test/fixtures/cf-edge/` (mints it per spec section 3.3). The fixture ships the applied Worker (`src/index.mjs`), the JWT validator (`src/jwt-validator.mjs`, sole reader of the `Cf-Access-Jwt-Assertion` header), a dependency-free RS256 fixture-JWT signer (`test/jwt-signer.mjs`) and a local JWKS server (`test/jwks-server.mjs`). No new rcf-lite runtime dependency (Node's built-in `crypto` module signs and verifies).
- Extends `packages/rcf-lite/test/fixtures/probe-pack-application-admin-console/` with a `/admin/sign-in` route rendering the Access-gated surface (with `?caps=zeroTrustGate`) or the local-login surface (without). The extension rides `application-admin-console` v1.1.0.
- Anatomy test at `packages/rcf-lite/test/blueprint/edge-cloudflare-access-anatomy.test.js` covers `TS-110..119` on the chain slice (blueprint shape, contributions cross-check, JWT validator behaviour, sole-reader guarantee, audit-event secrecy, break-glass posture, admin-console composition, fixture files, ADR bodies and clauses, guide sections and vendor URL).

### Known limitations

- The `real-account-gated-url` probe records `accountBoundSkipped: true` and aggregates to `pass` when `CI_HAS_CLOUDFLARE_ACCOUNT` or `CF_ACCESS_HOST` are unset (spec section 3.5 pass-with-skip). Full mechanism reach requires a CI environment with both env vars set and a deployed hostname behind an issued Zero Trust policy.
- The v1.0.0 boundary defers per-path policy scope authoring, group-membership rule authoring and identity-provider federation to v1.1.0. The shipped validator observes the JWT's `groups` claim but does not enforce policy on it (the Cloudflare edge enforces before the request reaches the origin Worker); a future minor could ship a group-membership refinement.
- The `wrangler-seam` probe warns (never fails) when `wrangler` is not installed under `packages/rcf-lite/test/fixtures/cf-edge/node_modules/.bin/wrangler`; a handler thrown at the workerd boundary is a genuine fail per the round-6 gate directive.
- The Access-gated sign-in surface on `application-admin-console` v1.1.0 shows a placeholder principal email in the fixture (supplied via `?principalEmail=` or `ADMIN_CONSOLE_PRINCIPAL_EMAIL` env var). In a real deployment the principal reads from `request.auth.email` the JWT validator attaches; the fixture does not embed the validator (it renders the surface).
