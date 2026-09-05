# Admin console blueprint (v1.0.0)

Vendor-neutral admin-console shell for an rcf-lite application. Surfaces are CONDITIONAL on what the applied identity blueprint declares. Ships the console shell with navigation across the applied surfaces (no dead links to unapplied capabilities), a users directory with invite and deactivate controls, a permission matrix rendered as an ARIA APG grid with the Owner + Admin + Member + Viewer baseline, an org switcher for multi-tenant projects, an audit-log surface reading a delivered event stream, and an access-denied and request-access state per WCAG. Introduces the capability-declaration mechanism (`capabilities[]` on identity blueprints) and the apply-time discovery, refusal and custom-auth elicitation the spec section 5.5 ratifies. Ships a Playwright probe pack under `probe-packs/application-admin-console.pack.mjs` whose four checks are capability-gated: an absent capability records `applicable: false` and the aggregate verdict treats it as neither pass nor fail (spec section 3.3).

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-admin-console
```

Refuses with exit 3 and the spec 5.5.1 verbatim message on a project with no applied blueprint declaring `principalDirectory` unless `--allow-no-auth-yet` is passed for a scaffolding pass. Prompts the elicitation phase for parameters whose `when` predicate resolves true against the discovered applied-capability set. Writes a sidecar `rcf/blueprints/application-admin-console.applied.json` capturing the discovered `appliedCapabilities`, the elicit answers, and (when overridden) the scaffolding-note. Consumes the `logging` and `errorHandling` companions when they resolve to an applied provider or a registered library; falls back to the shelf providers otherwise.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, `requiresAppliedCapabilities: [principalDirectory]`, `elicits[]` (baseline-roles, tenancy-shape, invite-transport, audit-retention-days), `suggestedCompanions: [logging, errorHandling]`, 23 contributions in the 22xx / 21xxx band |
| Doc set | `contributions/` | 6 REQs, 9 USs (16 runtime-observable ACs), 4 TACs, 4 ADRs |
| Probe pack | `probe-packs/application-admin-console.pack.mjs` | Four capability-gated browser-verify checks anchored to AC-21102-1, AC-21103-1, AC-21104-1, AC-21105-1 |
| Guide | `guide/application-admin-console.md` | Operator-facing: when to reach, when not, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | Shelf id band registry update; no new global topics claimed |
| Sample-app fixture | `packages/rcf-lite/test/fixtures/probe-pack-application-admin-console/` | Dependency-free Node HTTP server the pack is probed against on the shelf gate |

## Conditionality: what surfaces render when

| Applied capability | Surface | Rendered by |
|---|---|---|
| `principalDirectory` | Users directory (`/admin/users`) | Any applied auth blueprint (magic-link, clerk, oauth2, keycloak). |
| `roleModel` | Permission matrix (`/admin/roles`) | Clerk, OAuth2, Keycloak. Magic-link does NOT declare it, so a bare-magic-link project gets NO roles surface (Baz's example, spec section 5.5). |
| `tenancy` | Org switcher (`/admin/orgs`), org-scoped invites | Reserved for a future `application-tenancy-orgs` blueprint (spec section 11). No shelf provider today. |
| `auditLog` | Audit-log surface (`/admin/audit`) | Via the applied `observability-logging` companion (implicit), or a future dedicated audit-log blueprint. |
| (none) | Access-denied + request-access | Always renders for a non-admin principal reaching `/admin/*`. |

## Bare-SPA refusal

On a project with only `application-spa` applied (no auth), the apply exits 3 with:

```
application-admin-console requires at least one applied security-auth-* blueprint,
or an operator override with --allow-no-auth-yet.

Applied blueprints on this project:
  application-spa v1.5.0

Suggested next steps:
  1. Apply an auth blueprint first:
       rcf define blueprint add security-auth-magic-link
     (or security-auth-clerk, security-auth-oauth2, security-auth-keycloak)
  2. Override for a scaffolding pass (surfaces will refuse at apply until an
     auth blueprint is applied):
       rcf define blueprint add application-admin-console --allow-no-auth-yet
```

The override records a note on the sidecar's `notes` field so `rcf define validate` reads back and flags surfaces that never activated.

## Custom-auth projects (auth outside the shelf)

A project that ships its own auth surface (no shelf `security-auth-*` blueprint applied) supplies capability answers via the elicitation phase:

```
rcf define blueprint add ./blueprints/application-admin-console \
  --answer baseline-roles="Owner, Admin, Member, Viewer, SupportAgent" \
  --answer tenancy-shape=per-user \
  --answer invite-transport=email
```

Answers land on `rcf/blueprints/application-admin-console.applied.json`'s `appliedElicitations{}` map. The `when` predicate on each elicit gates whether the prompt fires: `baseline-roles` only fires when `roleModel` is applied, `tenancy-shape` only when `tenancy` is applied, and so on.

## The one runtime gate

`probe-packs/application-admin-console.pack.mjs` ships four checks the `rcf verify browser` runner invokes on any FBS whose surface matches the pack's `appliesTo` predicate (an FBS that binds `TAC-2201-application-admin-console-shell` or whose nav model routes name an admin path). Each check ALSO carries its own `appliesTo` predicate that reads the applied capability sidecar and returns false when the required capability is absent; the check records `applicable: false` and the aggregate verdict treats it as neither pass nor fail (spec section 3.3, T-5 residual cure). This is exactly the residual pattern the spec named: the surface does not exist, so the pack does not fire.

Each check drives the real Playwright browser the runner provisions (through the pinned Playwright MCP or the consuming project's own `playwright` installation), reads the accessibility tree and the DOM, and returns a verdict.

## Quality bar

ARIA APG grid pattern on the permission matrix (ADR-2201, TAC-2203); role="row", role="rowheader", role="columnheader", role="gridcell" and per-cell aria-label announcing the permission string on focus (WCAG 4.1.3). Every access-denied state renders under WCAG 2.4.6 Headings and Labels and 3.3.4 Error Prevention with a keyboard-reachable request-access control and a polite live region announcing state changes. Every table surface enumerates rows by `data-<entity>-id` (users by `data-user-id`, audit entries by `data-audit-id`) inside the `data-surface` region. The Owner + Admin + Member + Viewer baseline is drawn from SaaS UI research 2026 (ADR-2202); the retention window on the audit view is elicited per project (ADR-2204).

## Known mechanism-reach gaps

Runtime-observable ACs the pack does NOT bind directly (checklist section 6.g), listed individually:

- **AC-21101-2 (single primary nav landmark with accessible name).** Present on the fixture as `<nav data-role="primary-nav" aria-label="Admin console">`; the pack asserts the fixture renders the four surfaces but does not additionally probe the landmark's accessible name. A v1.1.0 minor bump can add a landmark-shape check driven by the accessibility tree.
- **AC-21102-2 (per-row invite / deactivate control shape).** Present on the fixture as `[data-action="invite"]` and `[data-action="deactivate"]` buttons; the pack's AC-21102-1 check confirms the users directory renders row ids but does not additionally exercise the invite / deactivate click paths. A v1.1.0 minor bump can extend AC-21102-1 with a click-round-trip.
- **AC-21103-2 (elicited additional roles rendered after the baseline four).** Present on the fixture as the Owner + Admin + Member + Viewer rank order; the pack's AC-21103-1 confirms the grid roles and per-cell announcements but does not additionally probe elicited-role position. A v1.1.0 minor bump can read the sidecar's `appliedElicitations.baseline-roles` and compare rank order.
- **AC-21105-2 (audit view consumes the datatable shell TAC).** Realised on the fixture by rendering the audit table with the same column contract; the pack's AC-21105-1 confirms the correlation-id column but does not additionally probe the datatable shell's four state regions on the audit view. Datatable's own pack (T-1) still covers those on projects that render the audit view through the datatable factory.
- **AC-21106-1 (access-denied region accessibility structure beyond the request-access control).** The pack's AC-21102-1 check probes the request-access control on the denied branch; the wider WCAG structure (heading, explanation, polite live region wiring) is present on the fixture but not additionally asserted. A v1.1.0 minor bump can add an axe-core sweep on the denied region.
- **AC-21107-1 (sidecar file served under a stable path).** The pack reads the sidecar from `projectRoot`; the CLIENT-side read (over the network at load time) is a runtime-observable surface the pack does not additionally probe. A v1.1.0 minor bump can add a probe that reads `/admin/caps.json` on the fixture and diffs against the applied sidecar.
- **AC-21108-1 (providesRoles absent on the blueprint).** A chain-scope AC probed by the anatomy tests, not by the browser pack.
- **AC-21109-1 and AC-21109-2 (apply-time refusal and override).** Probed by the mechanism unit tests, not by the browser pack. The gate reviewer runs the CLI directly.

## Companions

`suggestedCompanions` declares `logging` (the audit-log surface reads the event stream the applied logger emits) and `errorHandling` (invite failures and role-change refusals construct internal error records). Neither is required to apply the blueprint; the audit surface simply suppresses when `logging` is not applied.

## Consumers

The audit view consumes `application-datatable` (T-1) for its table shell contract. Every project applying `application-admin-console` should also apply `application-datatable` if they want the ARIA APG table pattern, filter chrome, four state regions and pagination on the audit view.
