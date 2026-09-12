# application-admin-console CHANGELOG

## 1.3.6 - 2026-09-12

- Positive-evidence row shape tightened in the anatomy helper: a positive row now requires a non-empty engine-returned `requestId` AND (a non-empty `bodyExcerpt` OR a non-empty `derived` object); a `{derived:{}}` alone or a `requestId` alone no longer counts, with two new negative-case tests covering the empty-derived and id-only patterns. Anatomy negative-variant map extended with `{brk:"local-login-form", probes:["sign-in-access-gated-surface"]}` so the shipped `?break=local-login-form` fixture switch drives the positive AC-21816-1 local-login row to fail (the break drops the `[data-role="local-login-form"]` region on the sign-in surface). No probe or fixture behaviour change on the admin-console family beyond the anatomy shape helper and the negative-variant coverage.

## 1.3.5 - 2026-09-12

- Rule-7d shape fix on every de-claimed conformance row across users-directory (four AC-21102-1 / AC-21102-2 rows), permission-matrix (AC-21103-1), org-switcher (AC-21104-1), audit-log (AC-21105-1) and sign-in-access-gated (AC-21815-2): each row now carries `anchorAcId: null` and names the anchored AC in the `limitation` field per the shipped shape (a `conformanceOnly:true` row must not simultaneously claim an anchor). Positive-observation rows on AC-21815-1, AC-21816-1 and the org-switcher AC-21104-2 no-tenancy branch stay anchored. Fixture README env-var manifest now declares `PROBE_BREAK` (the fixture reads it as an alternate to `ADMIN_CONSOLE_BREAK` / `?break=`) and the probe-utils `DECLARED_ENV` list mirrors the addition. Anatomy shape check tightened to reject an anchored `conformanceOnly` row (a positive evidence field no longer bypasses the null-anchor + limitation contract); a new negative-case test constructs an anchored `conformanceOnly` row and asserts the shape helper throws.

## 1.3.4 - 2026-09-11

- Shared `aggregate()` no longer promotes warn rows to pass: any row with verdict warn (including honest de-claim rows) lifts the aggregate to warn; a probe whose rows are all warn aggregates to warn, not pass. Shared teardown propagates a SIGKILL failure through the returned kill() promise instead of swallowing it. Overclaiming rows across users-directory (AC-21102-1, AC-21102-2), permission-matrix (AC-21103-1), org-switcher (AC-21104-1), audit-log (AC-21105-1) and sign-in-access-gated (AC-21815-2) are de-claimed to `conformanceOnly:true` with `verdict:'warn'` and a `limitation` field naming the anchored AC and the varied-input or browser-only clause that lives outside the Node HTTP probe. Positive-observation rows kept on AC-21815-1 (Access-gated Authorization-bearing surface), AC-21816-1 (local-login fallback) and the org-switcher no-tenancy 404 branch. Anatomy test extended with a negative-variant assertion that the shipped fixture break switches drive the affected probe aggregates to fail.

## 1.3.3 - 2026-09-11

- sign-in-access-gated-surface fixture now returns HTTP 403 with the `[data-surface="access-denied"]` region (and no `[data-role="principal-read"]` element) when `zeroTrustGate` is applied AND no Authorization header is present, wiring the previously-dead `renderSignInAccessDenied` branch to observe AC-21815-2's refusal contract server-side. The probe's AC-21815-2 row is now a positive-evidence row (HTTP 403 + access-denied surface + absence of principal-read) rather than a `notObservableHere` de-claim. Consumers that expected the previous 200-with-default-principal shape (`edge-cloudflare-access` TC-117, TC-118, TC-119 and its admin-console-gate-surface probe) send an Authorization header on the gated caps path; the local-login branch (no `zeroTrustGate`) is unchanged. Anatomy test extended to enumerate the shipped AC/REQ id set and refuse any row whose anchor is not in it, and to accept the conformance-only row shape.

## 1.3.2 - 2026-09-11

- users-directory-surface split into per-AC rows: AC-21102-1 anchors the directory listing observation; AC-21102-2 anchors the invite and deactivate controls (previously conflated on one row). org-switcher-surface fixture now returns HTTP 404 on the no-tenancy path so the probe can observe the AC-21104-2 refusal status (previously the fixture returned 200 with not-found HTML, contradicting the AC). audit-log-surface probe now drives a real write-then-read cycle: POST /api/members/:id/role writes an audit entry and GET /admin/audit reads it back, observing AC-21105-1 rather than a hard-coded table. sign-in-access-gated-surface probe now varies an Authorization principal and observes the derived email on the principal-read element; the local-fallback row is anchored under AC-21816-1. permission-matrix-grid vacuous `.every()` over an empty label array replaced with a check that asserts at least one label exists and every cell carries one per AC-21103-1. Positive-anchor-on-absence broken-variant rows removed. Rule 10 applied to every row detail. Anatomy test extended to accept notObservableHere row shape. Register cleanup.


## 1.3.1 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering 5 properties the fixture engine at `packages/rcf-lite/test/fixtures/probe-pack-application-admin-console/server.js` answers: `users-directory-surface`, `permission-matrix-grid`, `org-switcher-surface`, `audit-log-surface`, `sign-in-access-gated-surface`. Every response now carries an `x-fixture-request-id` header; probes record the id, the HTTP status and a body excerpt as positive evidence per rule 7d. Fixture README declares every env var the pack reads. Anatomy test at `packages/rcf-lite/test/blueprint/application-admin-console-anatomy.test.js` pins the new pack files and asserts each result carries one of the four 7d evidence shapes.


## 1.3.0 (2026-09-10)

### Added

- REQ-009: custom-auth-provides-* runtime clauses covering the four boolean elicits with a per-token clause on the applied capability union sidecar the shell reads.
- Vendor citations on AC-21103-1 (ARIA APG grid) and AC-21106-1 (WCAG headings-and-labels), verified 2026-09-10.

### Changed

- ADR-2203.decision names the elicit as `blueprint.json.elicits[id=invite-transport]` (drops the camelCase inviteTransport spelling).
- ADR-2204.decision names the elicit as `blueprint.json.elicits[id=audit-retention-days]`.
- AC-21111-2 (and AC-21111-5) use `data-org-membership=*` per REQ-008 with ownerRef into REQ-008.
- TAC-2214 responsibility named `renderAccessGatedSurface` so REQ-014.deliveredBy resolves.
- AC-21107-1 and AC-21107-2 reference `TAC-2201.interfaces.capabilitiesSidecar` via ownerRef; TAC-2201 shape declares `skippedSources[]`.
- US-21108 description carries the single-AC legality note verbatim.

## 1.2.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.2.0 (2026-09-10)

### Added

- REQ-007 (invite-transport option coverage) and US-21110: every invite-transport option (email, in-app-only, custom) now carries a runtime clause and a story binding accepted, failed and recorded outcomes with a per-invite audit record.
- REQ-008 (tenancy-shape option coverage) and US-21111: the elicited tenancy-shape (per-user, per-org, both) now determines directory membership, org switcher entries, invite scope and cross-shape refusal (TENANCY_SHAPE_REFUSAL).
- Failure-path acceptance criteria on US-21106 (request-access POST failure) and US-21107 (empty union entry for a library-qualified source unavailable locally); failure-path AC on US-21815 for a gated request with no request.auth.
- Vendor citations on the WCAG 2.4.6 / 3.3.4 / 4.1.3 fixed acceptance criteria and on the ARIA APG grid pattern criteria (verified 2026-09-10).

### Changed

- Every REQ now carries a deliveredBy link into TAC-2201, TAC-2203, TAC-2204 or TAC-2214.
- Every AC on every user story now carries an explicit disposition (fixed or template); template ACs state the values the applying agent sets.
- TAC-2201 responsibilities now include deliverInvite (per invite-transport branch), tenancyShapeGate (per tenancy shape), delegateUsersSurface, delegateOrgsSurface, renderAccessDenied and renderShell so the deliveredBy fields resolve.
- REQ-005 extended with an audit-retention-days runtime clause naming the string elicit and its refusal branch; US-21105 gained a template AC (AC-21105-3) carrying `Applying agent sets: audit-retention-days.`.

## 1.1.0 (2026-09-07)

### Added

- Consume the `zeroTrustGate` capability optionally at apply-time via the shipped `readAppliedCapabilities()` helper (the visual-round mechanism). When `zeroTrustGate` is in the applied capability set, `/admin/sign-in` renders the Access-gated sign-in surface: `[data-surface=access-gated]` with no local login form, plus a `[data-role=principal-read]` element carrying the principal email read from `request.auth`. When `zeroTrustGate` is absent the surface falls back to the local `security-auth-*` surface with `[data-surface=local-login]` and the existing local form. Additive minor: `requiresAppliedCapabilities.capabilities[]` stays `["principalDirectory"]` (Q4 default per Cloudflare round 6 spec section 5.4.1: making Access-gate hard is a v2.0 change).
- 6 new contributions on the admin-console shelf entry: 1 REQ (`application-admin-console-REQ-014`), 2 USs (`application-admin-console-US-21815` Access-gated sign-in, `application-admin-console-US-21816` fallback branch), 1 TAC (`TAC-2214-application-admin-console-access-gated-signin-surface`), 1 ADR (`ADR-2214-application-admin-console-consume-zero-trust-gate`, scope global on new topic `adminConsoleSignInSurface` with `standardsTraceClause: Cloudflare round 6 spec section 5.4 (admin-console v1.1.0 delta)` and `recommendedDefault: true`) and 1 pack check (`AC-21815-1`) on the existing `application-admin-console.pack.mjs`.
- Sign-in route extension on the shipped `packages/rcf-lite/test/fixtures/probe-pack-application-admin-console/` fixture: a new `/admin/sign-in` route that renders the Access-gated or local-login surface based on the applied caps (`?caps=zeroTrustGate` picks the gated branch). The existing `?caps=` combinations are preserved; the `AC-21815-1` pack check exercises both branches.

### Composition

- Rides the PR alongside `edge-cloudflare-access` v1.0.0 (round-4 capability-minor pattern). The Access-gated surface reads `request.auth.email`, which the shipped `edge-cloudflare-access` JWT validator sets after JWKS verification.

## 1.0.0 (visual round, spec 2026-09-04)

- Initial shipped version of the shelf's admin-console blueprint. Six REQs (console shell with no dead links, conditional users, conditional roles with Owner + Admin + Member + Viewer baseline, conditional orgs, conditional audit-log, access-denied plus request-access), nine USs 21101-21109 binding 16 runtime-observable ACs, four TACs 2201-2204 (shell, capability discovery, permission matrix, audit view consuming datatable), four ADRs 2201-2204 (capability vocabulary, baseline roles, invite transport, audit retention). No new global topics.
- Introduces the capability-declaration mechanism: `capabilities[]` on identity blueprints (v1.1.0 minor bumps on magic-link, clerk, oauth2, keycloak land in the same PR per spec Q2 default), `requiresAppliedCapabilities` and `elicits[]` on consumer blueprints, apply-time discovery via source read-back on `manifest.blueprints[]`, exit-3 refusal with the spec 5.5.1 verbatim message on bare-SPA applies, and a `--allow-no-auth-yet` operator override.
- Persists per-project apply-time state in a sidecar `rcf/blueprints/application-admin-console.applied.json` (the applied-blueprint-record schema in rcf-schemas 0.6.0 is closed under additionalProperties:false; the source-manifest read-back precedent from the core-companions train applies here). The sidecar carries `appliedCapabilities`, `appliedElicitations`, `allowNoAuthYet?` and `notes?`.
- Ships `probe-packs/application-admin-console.pack.mjs`: four capability-gated browser-verify checks anchored to AC-21102-1 (users), AC-21103-1 (permission matrix), AC-21104-1 (org switcher), AC-21105-1 (audit-log surface). Each check reads the applied capability sidecar and records `applicable: false` where its required capability is absent (residual cure). Fifth shipped consumer of the earlier release probe-pack runner extension.
- Ships a dependency-free sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-admin-console/` with `CAPS` env or `?caps=` query switch selecting which surfaces exist, break switches for the negative runs (matrix-grid, denied, audit-fields), and the mandatory README for the gate reviewer.
- Consumes `application-datatable` for the users and audit surfaces; declares `suggestedCompanions` logging and errorHandling.
- Does NOT declare `providesRoles` per spec 5.5.3 (the console is a consumer of `principalDirectory`, never a provider).
