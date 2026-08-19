# Wireframe: sign-in

The authentication entry surface (spa-US-1115). Motion-quiet (AC-1119-4), full spa-REQ-007 form contract, both themes, all breakpoints.

## Shape

```
+--------------------------------------------------------------------------+
| minimal banner: product logo (links to landing) | theme toggle           |
|                                                                          |
|                    +------------------------------+                      |
|                    |  h1  Sign in to <Product>    |                      |
|                    |                              |                      |
|                    |  [ error alert renders here  |                      |
|                    |    on failed sign-in ]       |                      |
|                    |                              |                      |
|                    |  Email                       |                      |
|                    |  [___________________]       |                      |
|                    |                              |                      |
|                    |  Password                    |                      |
|                    |  [___________________] [show]|                      |
|                    |                              |                      |
|                    |  [        Sign in        ]   |                      |
|                    |                              |                      |
|                    |  Forgot your password?       |                      |
|                    +------------------------------+                      |
|                                                                          |
| contentinfo: support link | legal                                        |
+--------------------------------------------------------------------------+
```

Card on surface-raised above 768; full-width single column on surface at 360.

## Behaviour

- Email field: type=email, autocomplete=username, inputmode=email. Password: autocomplete=current-password, show/hide toggle with accessible name and state (AC-1113-6).
- Failed sign-in: one alert above the form, safe copy that never says which element was wrong (AC-1115-2); fields keep their values except the password.
- Pending: button busy, duplicate submits ignored (AC-1115-3).
- Success: forward to the deep-link target when one is pending (AC-1116-5, validated per AC-1116-6), else the default authenticated route.
- Arriving already signed in redirects to the default authenticated route.
- First focusable element is the skip-link, then the email field receives initial focus.
