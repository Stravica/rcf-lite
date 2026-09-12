# probe-pack-application-account-settings fixture

Dependency-free sample app the `application-account-settings` probe pack drives on the shelf gate. One Node HTTP server, one shell HTML per surface, one inline client script. Framework-free by design.

## Env-var manifest (criterion-e probes read these)

Every environment variable the fixture or a `contributions/probes/` probe reads is declared here. A probe that short-circuits on an undeclared variable would prove nothing (rule 7d).

| Var | Purpose |
|---|---|
| `PORT` | default 3000; probe picks 47620-47629; 4200 is refused |
| `ACCOUNT_SETTINGS_CAPS` | comma list; default `principalDirectory` |
| `ACCOUNT_SETTINGS_APPS` | comma list mirroring applied blueprints; default empty |
| `ACCOUNT_SETTINGS_SECURITY_SHAPE` | elicited `security-surface-shape`; default `self-service` |
| `ACCOUNT_SETTINGS_HOSTED_URL` | elicited `hosted-identity-url`; default `https://hosted.example.com/account` |
| `ACCOUNT_SETTINGS_THEME_PERSIST` | elicited `theme-persistence`; default `spa-local-storage` |
| `PROBE_BREAK` | optional default `?break=` switch across every request; per-request `?break=` still wins when set. Values: `leak-tab`, `no-autocomplete`, `no-dialog`, `no-persist` |

Every response emits an `x-fixture-request-id` HTTP header (a per-request UUID). The criterion-e probes echo this id back into their `.rcf/reports/` run records as positive evidence per rule 7d (a real request identifier answered by the fixture engine).

## Criterion-e probe pack

`blueprints/application-account-settings/contributions/probes/` boots this fixture on a scratch port in its declared family range and drives varied inputs (different query strings and env overlays) to derive DOM observables. Each probe result carries an `evidence` object with the fixture's request id, the HTTP status and a response-body excerpt. No account credentials are involved: this blueprint's deliverable is application code and the fixture built from its own contributions IS the engine (the application-code engine rule).


## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-account-settings
node server.js
```

Prints `LISTENING <port>` once bound.

## Environment

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port the server binds to. Never 4200 (workspace server owns that port; the fixture refuses). | `3000` |
| `ACCOUNT_SETTINGS_CAPS` | Comma-separated capability list mirroring `manifest.blueprints[application-account-settings].appliedCapabilities`. | `principalDirectory` |
| `ACCOUNT_SETTINGS_APPS` | Comma-separated applied-blueprint slug list mirroring `application-notifications-in-app` and `application-spa` gating. | `` (empty) |
| `ACCOUNT_SETTINGS_SECURITY_SHAPE` | Elicited `security-surface-shape`. | `self-service` |
| `ACCOUNT_SETTINGS_HOSTED_URL` | Elicited `hosted-identity-url`. | `https://hosted.example.com/account` |
| `ACCOUNT_SETTINGS_THEME_PERSIST` | Elicited `theme-persistence`. | `spa-local-storage` |

## Query switches

| Query | Purpose |
|---|---|
| `?caps=<comma-list>` | Override the applied capability set for one page load. |
| `?apps=<comma-list>` | Override the applied-blueprint set for one page load. |
| `?security-surface-shape=<self-service | hosted-link-out | hosted-embed>` | Override the elicited security shape. |
| `?theme-persistence=<spa-local-storage | server-scoped | none>` | Override the elicited theme persistence. |
| `?authed=false` | Simulate an unauthenticated principal; renders the forbidden state from T-1 (empty-error-states). |
| `?break=leak-tab` | Render the security tab even when neither `credentialSelfService` nor `hostedIdentityUi` is applied (suppression check fails). |
| `?break=no-autocomplete` | Drop `autocomplete` tokens on the profile form (profile check fails). |
| `?break=no-dialog` | Render session terminate without the ARIA dialog-modal (sessions check fails). |
| `?break=no-persist` | Drop the client-side theme persistence write AND (under the server-scoped store) refuse the server-side POST `/api/theme` with HTTP 507 `THEME_WRITE_REFUSED` and DELETE `/api/theme` with HTTP 507 `THEME_CLEAR_REFUSED`, so the theme-radiogroup probe's server-scoped-persistence observation fails on AC-25108-1. |

## Routes

- `/account` shell (mirrors `/account/profile`).
- `/account/profile` profile surface (always available).
- `/account/security` security surface (fires when `credentialSelfService` or `hostedIdentityUi` is in caps).
- `/account/sessions` sessions surface (fires when `sessionInventory` is in caps).
- `/account/notifications` notification preferences (fires when `application-notifications-in-app` is in apps).
- `/account/theme` theme surface (fires when `application-spa` is in apps).

## Manual boot for the gate reviewer

Five lines, one per fixture caps combination the section 6 T-4 gate rows walk:

```
PORT=4321 ACCOUNT_SETTINGS_CAPS=principalDirectory node server.js                                                 # magic-link
PORT=4322 ACCOUNT_SETTINGS_CAPS=principalDirectory,roleModel,sessionInventory,hostedIdentityUi ACCOUNT_SETTINGS_APPS=application-notifications-in-app,application-spa ACCOUNT_SETTINGS_SECURITY_SHAPE=hosted-link-out node server.js  # clerk
PORT=4323 ACCOUNT_SETTINGS_CAPS=principalDirectory,roleModel,credentialSelfService,sessionInventory node server.js                                                                                                                    # keycloak
PORT=4324 ACCOUNT_SETTINGS_CAPS=principalDirectory,credentialSelfService,principalDirectory ACCOUNT_SETTINGS_SECURITY_SHAPE=self-service node server.js                                                                                # custom-auth
PORT=4325 ACCOUNT_SETTINGS_CAPS=principalDirectory node server.js                                                                                                                                                                     # bare with override
```

Then hit the surfaces and confirm the DOM matches the expectations the pack asserts (`data-surface=<tab>`, `role="tablist"` on the nav, autocomplete tokens on profile, `role="dialog"` on terminate).
