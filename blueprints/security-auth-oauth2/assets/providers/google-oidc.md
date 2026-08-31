# Google (OIDC) provider record

A sample provider record shape for Google as an OIDC provider. All fields are placeholders; the operator populates them from a project registered at the provider's console.

```
{
  id: 'google',
  label: 'Sign in with Google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  issuer: 'https://accounts.google.com',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  clientId: '<PLACEHOLDER_GOOGLE_CLIENT_ID>',
  clientSecret: '<PLACEHOLDER_GOOGLE_CLIENT_SECRET>',
  scopes: ['openid', 'profile', 'email'],
  redirectUri: '<PLACEHOLDER_PROJECT_CALLBACK_URL>',
  flow: 'authorisation-code-pkce',
  providerKind: 'oidc',
  endSessionEndpoint: null,
  providerLogout: 'none',
  enabled: true
}
```

Notes for the operator:
- The `clientId` and `clientSecret` come from a project registered at the provider's console; the redirect URI must match one of the registered URIs for the project or the token exchange refuses.
- `endSessionEndpoint` is null because Google does not currently expose an RP-initiated logout endpoint; leaving `providerLogout: 'none'` clears only the project session on sign-out. A project that wants a full downstream logout drives the operator to the provider's account page.
- The scopes list is the minimum for identity; a project reaching for additional Google APIs adds scopes here and the token exchange returns access tokens scoped to what was granted.

Do NOT commit the real `clientSecret` in the record; read it from `security-secrets-management` (when composed) or the process environment at boot.
