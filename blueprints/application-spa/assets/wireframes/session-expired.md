# Wireframe: session expired

Rendered when a request returns 401 mid-session (AC-1116-1). Distinct from sign-out: the user did not choose this, so the surface explains and preserves their place.

## Shape

```
+--------------------------------------------------------------------------+
| minimal banner: product logo | theme toggle                              |
|                                                                          |
|                    +------------------------------+                      |
|                    |   [ info icon alias ]        |                      |
|                    |                              |                      |
|                    |  h1  Your session expired    |                      |
|                    |                              |                      |
|                    |  Body: For your security you |                      |
|                    |  were signed out after a     |                      |
|                    |  period of inactivity. Sign  |                      |
|                    |  back in to pick up where    |                      |
|                    |  you left off.               |                      |
|                    |                              |                      |
|                    |  [ sign-in form or button    |                      |
|                    |    per project auth flow ]   |                      |
|                    +------------------------------+                      |
|                                                                          |
| contentinfo                                                              |
+--------------------------------------------------------------------------+
```

## Behaviour

- The interrupted route is remembered; successful re-authentication returns the user there (AC-1116-2), with declared form-input preservation honoured (AC-1114-4).
- Tone is neutral and unblaming (application-spa-REQ-017): expiry is a security behaviour, not a user mistake.
- If multiple requests fail at once, the surface renders once; parallel 401s must not stack redirects or alerts.
- The data layer stops retrying while this surface is up and resumes cleanly after re-authentication (TAC-204).
