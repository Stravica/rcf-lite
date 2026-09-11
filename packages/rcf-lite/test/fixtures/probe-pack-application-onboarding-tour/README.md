# probe-pack-application-onboarding-tour fixture

Dependency-free sample app the `application-onboarding-tour` probe pack drives on the shelf gate. One Node HTTP server, one inline client script that mounts the tour tooltip and the checklist. Framework-free by design.

## Env-var manifest (criterion-e probes read these)

Every environment variable the fixture or a `contributions/probes/` probe reads is declared here. A probe that short-circuits on an undeclared variable would prove nothing (rule 7d).

| Var | Purpose |
|---|---|
| `PORT` | default 3000; probe picks 47610-47619; 4200 is refused |
| `TOUR_APPS` | comma list mirroring appliedBlueprints[] |
| `TOUR_STORE` | `spa-local-storage`|`spa-session-storage`|`server-side-per-principal`; default `spa-local-storage` |
| `TOUR_ANCHOR` | `dashboard-top`|`settings-page`|`custom-anchor`; default derived from TOUR_APPS |
| `PROBE_BREAK` | optional default `?break=` switch across every request; per-request `?break=` still wins when set. Values: `no-role`, `focus-escape`, `no-collapse`, `no-persist` |

Every response emits an `x-fixture-request-id` HTTP header (a per-request UUID). The criterion-e probes echo this id back into their `.rcf/reports/` run records as positive evidence per rule 7d (a real request identifier answered by the fixture engine).

## Criterion-e probe pack

`blueprints/application-onboarding-tour/contributions/probes/` boots this fixture on a scratch port in its declared family range and drives varied inputs (different query strings and env overlays) to derive DOM observables. Each probe result carries an `evidence` object with the fixture's request id, the HTTP status and a response-body excerpt. No account credentials are involved: this blueprint's deliverable is application code and the fixture built from its own contributions IS the engine (the application-code engine rule).


## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-onboarding-tour
node server.js
```

Prints `LISTENING <port>` once bound.

## Environment

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port the server binds to. Never 4200 (workspace server owns that port; the fixture refuses). | `3000` |
| `TOUR_APPS` | Comma-separated applied-blueprint slug list mirroring the sidecar `appliedBlueprints[]`. Values include `application-dashboard`, `application-notifications-in-app`, `application-account-settings`, `application-spa`. | `` (empty) |
| `TOUR_STORE` | Elicited `completion-state-store`. Values: `spa-local-storage`, `spa-session-storage`, `server-side-per-principal`. | `spa-local-storage` |
| `TOUR_ANCHOR` | Elicited `checklist-anchor`. Values: `dashboard-top`, `settings-page`, `custom-anchor`. When absent, the fixture derives the anchor from `TOUR_APPS` (dashboard-top when `application-dashboard` is applied, settings-page otherwise). | derived |

## Query switches

| Query | Purpose |
|---|---|
| `?apps=<comma-list>` | Override the applied-blueprint set for one page load. Also mirrors the pack's `?caps=` naming pattern for parity with other round-4 fixtures. |
| `?caps=<comma-list>` | Reserved for future capability declarations; the T-5 blueprint declares no `capabilities[]`, so this switch has no effect today. Documented for shelf-gate parity with round-3 fixtures. |
| `?store=<spa-local-storage \| spa-session-storage \| server-side-per-principal>` | Override the completion-state store for one page load. |
| `?anchor=<dashboard-top \| settings-page \| custom-anchor>` | Override the checklist anchor. |
| `?first-run=<0 \| 1>` | Force first-run detection (1 opens the tour, 0 suppresses the auto-open). |
| `?complete=1` | Auto-complete the tour on load and drive the persistence write. Useful for the pack's persistence check without walking the tour. |
| `?state=<value>` | Reserved for state overrides; the T-5 blueprint has no state-shaped switches today. Documented for shelf-gate parity with round-3 fixtures. |
| `?theme=<light \| dark \| system>` | Reserved for theme overrides; the T-5 fixture renders theme-agnostic content. Documented for shelf-gate parity with round-3 fixtures. |
| `?break=no-role` | Drop `role="dialog"` on the tooltip (tooltip-as-dialog check fails on AC-26102-1). |
| `?break=focus-escape` | Do NOT trap Tab inside the tooltip so Tab escapes to the underlying surface (step-container focus check fails on AC-26101-1). |
| `?break=no-collapse` | Render the checklist without the `<details>` wrapper (checklist-slot check fails on AC-26103-1). |
| `?break=no-persist` | Skip the completion-state write (persistence check fails on AC-26104-1). |

## Routes

- `/` home surface (links to the tour, dashboard and settings).
- `/tour`, `/onboarding`, `/welcome` tour surface (opens the tooltip on first-run principals).
- `/dashboard` dashboard surface (mounts the checklist at dashboard-top when `TOUR_APPS` contains `application-dashboard`).
- `/settings`, `/account`, `/account/settings` settings surface (renders the restart-tour control and the checklist at settings-page anchor).

## Manual boot for the gate reviewer

Two lines, one per fixture apps combination the section 6 T-5 gate rows walk (checklist branch), plus one per completion-store branch:

```
PORT=4401 TOUR_APPS=application-dashboard,application-notifications-in-app,application-account-settings,application-spa TOUR_STORE=spa-local-storage node server.js   # dashboard-branch
PORT=4402 TOUR_APPS= TOUR_STORE=spa-local-storage node server.js                                                                                                       # settings-branch (no dashboard)
PORT=4403 TOUR_APPS=application-account-settings TOUR_STORE=spa-session-storage node server.js                                                                          # store branch: session
PORT=4404 TOUR_APPS=application-account-settings TOUR_STORE=server-side-per-principal node server.js                                                                    # store branch: server-side
```

Then hit `/tour?first-run=1`, `/dashboard`, `/settings` and confirm the DOM matches the expectations the pack asserts:

- `[data-role="onboarding-tour-tooltip"][role="dialog"]` on the tour surface, with `aria-labelledby` on the step heading and `aria-describedby` on the step body; focus moves to the tooltip on open.
- `details[data-role="onboarding-tour-checklist"][data-anchor="dashboard-top"][open]` on `/dashboard` when `TOUR_APPS` includes `application-dashboard`.
- `details[data-role="onboarding-tour-checklist"][data-anchor="settings-page"]` (closed) on `/settings` when `TOUR_APPS` does not include `application-dashboard`.
- `button[data-action="restart-tour"]` on `/settings`.
- `[data-role="onboarding-tour-completion-marker"][data-written-to="<store>"]` on `/tour?complete=1` after the tour finishes.

## Screen-reader smoke (manual)

`AC-26107-1` is documented as a mechanism-reach gap: rcf-lite does not drive a real screen reader in CI. The manual smoke on macOS VoiceOver: open `/tour?first-run=1` in Safari with VoiceOver on, confirm the step heading is read on open and the anchor label is read when focus returns on close. Runner cleanup rides `w-2026-09-04-dave-020`.
