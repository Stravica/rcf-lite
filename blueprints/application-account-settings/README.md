# Account settings blueprint (v1.0.0)

Vendor-neutral account-settings surface for an rcf-lite application. Surfaces are CONDITIONAL on what the applied identity blueprints and companion blueprints declare via `capabilities[]`. Ships the settings shell with an ARIA APG tabs region (no dead links to unapplied capabilities), a WCAG 1.3.5 profile surface (always active), a security surface with a self-service branch (password change, MFA) and a hosted-UI branch (link-out or embed), a sessions surface with an ARIA APG dialog-modal terminate flow, a notification preferences surface and a theme surface with light/dark/system. Reuses the visual round capability grammar and the apply-time discovery, refusal and custom-auth elicitation the spec section 5.4 ratifies. Ships a Playwright probe pack under `probe-packs/application-account-settings.pack.mjs` whose five checks are capability-gated: an absent capability records `verdict: skipped` and the aggregate verdict treats it as neither pass nor fail (spec section 3.3).

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-account-settings
```

Refuses with exit 3 and the spec 5.4.1 verbatim message on a project with no applied blueprint declaring `principalDirectory` unless `--allow-no-auth-yet` is passed for a scaffolding pass. Prompts the elicitation phase for parameters whose `when` predicate resolves true against the discovered applied-capability set. Writes a sidecar `rcf/blueprints/application-account-settings.applied.json` capturing the discovered `appliedCapabilities`, the elicit answers, and (when overridden) the scaffolding note. Consumes the `logging` and `errorHandling` companions when they resolve to an applied provider or a registered library; falls back to the shelf providers otherwise.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, `requiresAppliedCapabilities: [principalDirectory]`, `elicits[]` (four custom-auth capability provides plus security-surface-shape, hosted-identity-url, theme-persistence, reauth-window), `suggestedCompanions: [logging, errorHandling]`, 24 contributions in the 25xxx / 26xx bands |
| Doc set | `contributions/` | 6 REQs, 10 USs (13 runtime-observable ACs), 4 TACs, 4 ADRs |
| Probe pack | `probe-packs/application-account-settings.pack.mjs` | Five capability-gated browser-verify checks anchored to AC-25101-1, AC-25102-1, AC-25105-1, AC-25106-1, AC-25108-1 |
| Guide | `guide/application-account-settings.md` | Operator-facing: when to reach, when not, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | Shelf id band registry update; no new global topics claimed; cross-references application-empty-error-states and application-admin-console |
| Sample-app fixture | `packages/rcf-lite/test/fixtures/probe-pack-application-account-settings/` | Dependency-free Node HTTP server the pack is probed against on the shelf gate |

## Conditionality: what surfaces render when

| Applied capability | Surface | Rendered by |
|---|---|---|
| `principalDirectory` | Profile (`/account/profile`) always available | Any applied auth blueprint (magic-link, clerk, oauth2, keycloak). |
| `credentialSelfService` OR `hostedIdentityUi` | Security (`/account/security`) | credentialSelfService: Keycloak from 1.2.0, OAuth2 from 1.2.0 (provider-conditional). hostedIdentityUi: Clerk from 1.3.0, OAuth2 from 1.2.0 (provider-conditional). Neither present: security tab suppressed AND the Q3 refusal fires at apply if the operator answers `--answer security-surface-shape=...`. |
| `sessionInventory` | Sessions (`/account/sessions`) | Clerk from 1.3.0, Keycloak from 1.2.0, OAuth2 from 1.2.0. Owner: security-auth-clerk TAC-1003-security-auth-clerk-session-verifier field interfaces.sessionInventory (the shape any auth blueprint declaring the capability agrees to). Magic-link does NOT declare it; observability-logging 1.3.0 no longer declares it. |
| `application-notifications-in-app` applied | Notification preferences (`/account/notifications`) | Suppressed when the notifications-in-app blueprint is not applied. |
| `application-spa` applied | Theme (`/account/theme`) | Suppressed when the SPA blueprint is not applied. |
| (none) | Unauthenticated principal | Composes on `application-empty-error-states` forbidden state; no bespoke access-denied UI. |

## Bare-SPA refusal

On a project with only `application-spa` applied (no auth), the apply exits 3 with:

```
application-account-settings requires at least one applied security-auth-* blueprint,
or an operator override with --allow-no-auth-yet.

Applied blueprints on this project:
  application-spa v1.5.0

Suggested next steps:
  1. Apply an auth blueprint first:
       rcf define blueprint add security-auth-magic-link
     (or security-auth-clerk, security-auth-oauth2, security-auth-keycloak)
  2. Override for a scaffolding pass (surfaces will refuse at apply until an
     auth blueprint is applied):
       rcf define blueprint add application-account-settings --allow-no-auth-yet
```

The override records a note on the sidecar's `notes` field so `rcf define validate` reads back and flags surfaces that never activated.

## Q3 gate: security surface has no home

A project that declares `principalDirectory` (so apply is not refused at the bare-SPA gate) but NEITHER `credentialSelfService` NOR `hostedIdentityUi`:

1. Silently drops any `--answer security-surface-shape=<any>` at apply (the general elicits mechanism gates the answer via the `when` predicate; the sidecar records no `security-surface-shape` entry).
2. Renders the shell WITHOUT a security tab (AC-25101-1, probed by the pack).
3. Refuses the security surface at load time through TAC-2603 hosted-ui-bridge if a project-side FBS renders `/account/security` regardless (project-side enforcement per AC-25110-1 known mechanism-reach gap, spec section 5.4.1).

No `auth managed elsewhere` placeholder ships from the shipped shell surface. Per the ratified spec Q3 decision, the shell never lies about a surface that has no home.

## Custom-auth projects (auth outside the shelf)

A project that ships its own auth surface (no shelf `security-auth-*` blueprint applied) supplies capability answers via the elicitation phase:

```
rcf define blueprint add ./blueprints/application-account-settings \
  --answer custom-auth-provides-principal-directory=true \
  --answer custom-auth-provides-credential-self-service=true \
  --answer security-surface-shape=self-service
```

Answers land on `rcf/blueprints/application-account-settings.applied.json`'s `appliedElicitations{}` map. The `when` predicate on each elicit gates whether the prompt fires: `security-surface-shape` only fires when `credentialSelfService` OR `hostedIdentityUi` is applied (through the shelf or through the custom-auth elicits); `hosted-identity-url` only fires when `hostedIdentityUi` is applied; `theme-persistence` is unconditional (a project that does not apply the SPA blueprint records the answer and the shell simply suppresses the theme tab).

## The one runtime gate

`probe-packs/application-account-settings.pack.mjs` ships five checks the `rcf verify browser` runner invokes on any FBS whose surface matches the pack's `appliesTo` predicate (an FBS that binds `TAC-2601-application-account-settings-shell` or whose nav model routes name an `/account`, `/settings` or `/profile` path). Each check ALSO carries its own `appliesTo` predicate that reads the applied capability sidecar and returns false when the required capability is absent; the check records `verdict: skipped` and the aggregate verdict treats it as neither pass nor fail (spec section 3.3, residual cure).

Each check drives the real Playwright browser the runner provisions (through the pinned Playwright MCP or the consuming project's own `playwright` installation), reads the accessibility tree and the DOM, and returns a verdict.

## Quality bar

ARIA APG tabs pattern on the shell (TAC-2601); role="tablist" on the nav landmark with `aria-label="Account settings"`, role="tab" on each entry with `aria-selected="true"` on the active tab (WCAG 2.4.6). ARIA APG dialog-modal on the sessions terminate flow (TAC-2604, AC-25105-2); role="dialog" with aria-modal="true" and aria-labelledby to the heading, focus-trap, focus-return on close, polite live-region announcement on the confirm. WCAG 1.3.5 autocomplete tokens on every editable identifier on the profile surface (AC-25102-1). WCAG 3.3.8 Accessible Authentication Minimum on the security surface (ADR-2602). WCAG 3.3.4 Error Prevention on high-value changes gated by the reauth-window elicit (ADR-2604). The security-surface-shape default is elicited (ADR-2602 records no default: the shape leaks the vendor's identity architecture and no default is honest across all four combinations).

## Known mechanism-reach gaps

Runtime-observable ACs the pack does NOT bind directly (checklist section 6.g), listed individually:

- **AC-25101-2 (single primary nav landmark accessible name shape).** The pack's AC-25101-1 asserts the landmark's `aria-label` is present; a future v1.1.0 minor bump can add a heading-order assertion (h1 page, h2 active tab).
- **AC-25103-1 (self-service branch details beyond password + MFA regions).** The pack's AC-25105-1 confirms the two roles render; a future v1.1.0 minor bump can extend AC-25105-1 with a keyboard-flow assertion.
- **AC-25104-1 (hosted-embed sandbox token beyond allow-scripts).** The pack's AC-25105-1 confirms `allow-scripts` in the sandbox; the wider token set is documented on ADR-2602 but not additionally asserted.
- **AC-25105-2 (session-terminate focus-trap behaviour).** The pack's AC-25106-1 asserts the dialog is present and correctly wired; the focus-trap and focus-return behaviour is asserted at fixture-read time and by the project-side smoke tests, not by the pack's browser evaluate at v1.
- **AC-25107-1 (notification-preferences surface capability discovery).** The pack does NOT probe the notifications surface at v1.0.0; the shell tabs check (AC-25101-1) confirms the tab renders only when `application-notifications-in-app` is applied via the fixture's `?apps=` switch. A future v1.1.0 minor bump can add a dedicated notifications surface check.
- **AC-25109-1 and AC-25109-2 (apply-time refusal and override).** Probed by the mechanism unit tests, not by the browser pack. The gate reviewer runs the CLI directly.
- **AC-25110-1 (Q3 apply-time refusal for a missing security capability).** Probed by the mechanism unit tests via the extended `runElicitationPhase` refusal path (added in this PR), not by the browser pack.

## Known schema follow-ups

The applied-blueprint sidecar at `rcf/blueprints/application-account-settings.applied.json` uses the schema shape admin-console established (no `verdict: skipped` field on the applied-record; the pack runtime records `verdict: skipped` per-check per spec section 3.3, and rcf-schemas 0.6.1 has no `applicable: false` field for the record). A future rcf-schemas minor may adopt the `appliedCapabilities[]` field on the applied-blueprint record directly; the sidecar path stays supported for backward compatibility.

## Companions

`suggestedCompanions` declares `logging` (every rendered account surface writes one request-scoped log line with the correlation identifier) and `errorHandling` (profile-save, security-flow and session-terminate failures construct internal error records). Neither is required to apply the blueprint; the audit-history surface is deferred to v1.1.0.

## Consumers

The forbidden and empty-history states MAP to `application-empty-error-states`'s `forbidden` and `empty-list` states. Every project applying `application-account-settings` MUST also apply `application-empty-error-states` if they want the shipped access-denied state; the shell composes on the empty-error-states components rather than inventing bespoke UI.

The sessions and notification-preferences surfaces reuse the `application-datatable` (round-3) table shell contract when the project renders them through the datatable factory.
