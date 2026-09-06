# probe-pack-application-account-settings fixture

Dependency-free sample app the `application-account-settings` probe pack drives on the shelf gate. One Node HTTP server, one shell HTML per surface, one inline client script. Framework-free by design.

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
| `?break=no-persist` | Drop the theme persistence write (theme check fails). |

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
