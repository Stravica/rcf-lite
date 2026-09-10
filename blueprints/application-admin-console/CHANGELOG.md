# application-admin-console CHANGELOG

## 1.2.0 (2026-09-10, hardening pass B6b)

### Added

- REQ-007 (invite-transport option coverage) and US-21110: every invite-transport option (email, in-app-only, custom) now carries a runtime clause and a story binding accepted, failed and recorded outcomes with a per-invite audit record. Closes review finding [application-admin-console] F-1.
- REQ-008 (tenancy-shape option coverage) and US-21111: the elicited tenancy-shape (per-user, per-org, both) now determines directory membership, org switcher entries, invite scope and cross-shape refusal (TENANCY_SHAPE_REFUSAL). Closes review finding [application-admin-console] F-2.
- Failure-path acceptance criteria on US-21106 (request-access POST failure) and US-21107 (empty union entry for a library-qualified source unavailable locally) closing findings F-3 and F-4; failure-path AC on US-21815 for a gated request with no request.auth closing finding F-5.
- Vendor citations on the WCAG 2.4.6 / 3.3.4 / 4.1.3 fixed acceptance criteria and on the ARIA APG grid pattern criteria (verified 2026-09-10).

### Changed

- Every REQ now carries a deliveredBy link into TAC-2201, TAC-2203, TAC-2204 or TAC-2214.
- Every AC on every user story now carries an explicit disposition (fixed or template); template ACs state the values the applying agent sets.
- TAC-2201 responsibilities now include deliverInvite (per invite-transport branch), tenancyShapeGate (per tenancy shape), delegateUsersSurface, delegateOrgsSurface, renderAccessDenied and renderShell so the deliveredBy fields resolve.
- Review fix pass (2026-09-10): REQ-005 extended with an audit-retention-days runtime clause naming the string elicit and its refusal branch; US-21105 gained a template AC (AC-21105-3) carrying `Applying agent sets: audit-retention-days.`; README and ADR-2201 register scrubbed (no operator names). Closes review-fix-pass finding F-3 for the audit-retention-days string elicit.

## 1.1.0 (2026-09-07)

### Added

- Consume the `zeroTrustGate` capability optionally at apply-time via the shipped `readAppliedCapabilities()` helper (the T-5 visual-round mechanism). When `zeroTrustGate` is in the applied capability set, `/admin/sign-in` renders the Access-gated sign-in surface: `[data-surface=access-gated]` with no local login form, plus a `[data-role=principal-read]` element carrying the principal email read from `request.auth`. When `zeroTrustGate` is absent the surface falls back to the local `security-auth-*` surface with `[data-surface=local-login]` and the existing local form. Additive minor: `requiresAppliedCapabilities.capabilities[]` stays `["principalDirectory"]` (Q4 default per Cloudflare round 6 spec section 5.4.1: making Access-gate hard is a v2.0 change).
- 6 new contributions on the admin-console shelf entry: 1 REQ (`application-admin-console-REQ-014`), 2 USs (`application-admin-console-US-21815` Access-gated sign-in, `application-admin-console-US-21816` fallback branch), 1 TAC (`TAC-2214-application-admin-console-access-gated-signin-surface`), 1 ADR (`ADR-2214-application-admin-console-consume-zero-trust-gate`, scope global on new topic `adminConsoleSignInSurface` with `standardsTraceClause: Cloudflare round 6 spec section 5.4 (admin-console v1.1.0 delta)` and `recommendedDefault: true`) and 1 pack check (`AC-21815-1`) on the existing `application-admin-console.pack.mjs`.
- Sign-in route extension on the shipped `packages/rcf-lite/test/fixtures/probe-pack-application-admin-console/` fixture: a new `/admin/sign-in` route that renders the Access-gated or local-login surface based on the applied caps (`?caps=zeroTrustGate` picks the gated branch). The existing `?caps=` combinations are preserved; the `AC-21815-1` pack check exercises both branches.

### Composition

- Rides the T-4 PR alongside `edge-cloudflare-access` v1.0.0 (round-4 T-4 capability-minor pattern). The Access-gated surface reads `request.auth.email`, which the shipped `edge-cloudflare-access` JWT validator sets after JWKS verification.

## 1.0.0 (visual round T-5, spec 2026-09-04)

- First ratified version of the shelf's admin-console blueprint. Six REQs (console shell with no dead links, conditional users, conditional roles with Owner + Admin + Member + Viewer baseline, conditional orgs, conditional audit-log, access-denied plus request-access), nine USs 21101-21109 binding 16 runtime-observable ACs, four TACs 2201-2204 (shell, capability discovery, permission matrix, audit view consuming datatable), four ADRs 2201-2204 (capability vocabulary, baseline roles, invite transport, audit retention). No new global topics.
- Introduces the capability-declaration mechanism: `capabilities[]` on identity blueprints (v1.1.0 minor bumps on magic-link, clerk, oauth2, keycloak land in the same PR per spec Q2 default), `requiresAppliedCapabilities` and `elicits[]` on consumer blueprints, apply-time discovery via source read-back on `manifest.blueprints[]`, exit-3 refusal with the spec 5.5.1 verbatim message on bare-SPA applies, and a `--allow-no-auth-yet` operator override.
- Persists per-project apply-time state in a sidecar `rcf/blueprints/application-admin-console.applied.json` (the applied-blueprint-record schema in rcf-schemas 0.6.0 is closed under additionalProperties:false; the source-manifest read-back precedent from the T-2 core-companions train applies here). The sidecar carries `appliedCapabilities`, `appliedElicitations`, `allowNoAuthYet?` and `notes?`.
- Ships `probe-packs/application-admin-console.pack.mjs`: four capability-gated browser-verify checks anchored to AC-21102-1 (users), AC-21103-1 (permission matrix), AC-21104-1 (org switcher), AC-21105-1 (audit-log surface). Each check reads the applied capability sidecar and records `applicable: false` where its required capability is absent (T-5 residual cure). Fifth shipped consumer of T-0's probe-pack runner extension.
- Ships a dependency-free sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-admin-console/` with `CAPS` env or `?caps=` query switch selecting which surfaces exist, break switches for the negative runs (matrix-grid, denied, audit-fields), and the mandatory README for the gate reviewer.
- Consumes `application-datatable` (T-1) for the users and audit surfaces; declares `suggestedCompanions` logging and errorHandling.
- Does NOT declare `providesRoles` per spec 5.5.3 (the console is a consumer of `principalDirectory`, never a provider).
