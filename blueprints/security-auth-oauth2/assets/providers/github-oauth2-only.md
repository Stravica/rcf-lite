# GitHub (oauth2-only) provider record

A sample provider record shape for GitHub as an OAuth2-only provider. GitHub does not currently issue an id_token on the token exchange; the flow controller resolves identity through the `userinfoUrl` on this record. All fields are placeholders; the operator populates them from a project registered at the provider's console.

```
{
  id: 'github',
  label: 'Sign in with GitHub',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userinfoUrl: 'https://api.github.com/user',
  issuer: null,
  jwksUri: null,
  clientId: '<PLACEHOLDER_GITHUB_CLIENT_ID>',
  clientSecret: '<PLACEHOLDER_GITHUB_CLIENT_SECRET>',
  scopes: ['read:user', 'user:email'],
  redirectUri: '<PLACEHOLDER_PROJECT_CALLBACK_URL>',
  flow: 'authorisation-code-pkce',
  providerKind: 'oauth2-only',
  endSessionEndpoint: null,
  providerLogout: 'none',
  enabled: true
}
```

Notes for the operator:
- `providerKind: 'oauth2-only'` means the flow controller does not attempt id_token verification for this provider; identity is resolved through the userinfo endpoint. That is the correct posture for GitHub at v1.
- `issuer` and `jwksUri` are null because GitHub does not publish OIDC discovery. If GitHub adds OIDC support in the future the record migrates to `providerKind: 'oidc'` with the two fields populated; the flow controller's behaviour changes automatically.
- The scopes list is the minimum for identity plus verified email; a project that reaches for repository APIs adds scopes here.

Do NOT commit the real `clientSecret` in the record; read it from `security-secrets-management` (when composed) or the process environment at boot.
