# Magic-link email template

Two bodies, one subject. The routes compose `{{ signInUrl }}` from the deployment base URL, `/login/verify`, and the minted token; the routes pass `{{ expiryWindow }}` as the token's expiry in a human phrase (default: 'fifteen minutes'). The adapter receives all four fields on every call.

## Subject

```
Sign in to {{ appName }}
```

## Text body

```
Someone (hopefully you) asked to sign in to {{ appName }}.

Follow this link within the next {{ expiryWindow }} to complete the sign-in:

  {{ signInUrl }}

The link is single-use and expires. If you did not request a sign-in, ignore
this email; the link will do nothing on its own.
```

## HTML body

```html
<!doctype html>
<html>
  <body>
    <p>Someone (hopefully you) asked to sign in to {{ appName }}.</p>
    <p>
      Follow this link within the next {{ expiryWindow }} to complete the sign-in:
      <br>
      <a href="{{ signInUrl }}">{{ signInUrl }}</a>
    </p>
    <p>
      The link is single-use and expires. If you did not request a sign-in,
      ignore this email; the link will do nothing on its own.
    </p>
  </body>
</html>
```

Both bodies name the same URL. The plaintext copy is what the email adapter's provider is most likely to render for spam-scoring and preview purposes; keep them in sync.
