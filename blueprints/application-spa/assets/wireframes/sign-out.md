# Wireframe: sign-out confirmation

The surface rendered after a completed sign-out (AC-1115-4). Its job: confirm the session is closed, reassure, and offer the two next steps that make sense.

## Shape

```
+--------------------------------------------------------------------------+
| minimal banner: product logo | theme toggle                              |
|                                                                          |
|                    +------------------------------+                      |
|                    |   [ success icon alias ]     |                      |
|                    |                              |                      |
|                    |  h1  You are signed out      |                      |
|                    |                              |                      |
|                    |  Body: Your session has      |                      |
|                    |  ended on this device.       |                      |
|                    |                              |                      |
|                    |  [       Sign back in    ]   |                      |
|                    |  [ go to the public site ]   |                      |
|                    +------------------------------+                      |
|                                                                          |
| contentinfo                                                              |
+--------------------------------------------------------------------------+
```

## Behaviour

- Reached only after the server-side session is invalidated and client caches are cleared (ADR-205); rendering this surface with a live session is a defect.
- The theme choice persists across sign-out for the session (AC-1107-3); the per-user preference reapplies on next sign-in (AC-1107-4).
- Back-navigation after sign-out must not reveal cached authenticated content.
- No auto-redirect: the user chose to leave; let the surface rest.
